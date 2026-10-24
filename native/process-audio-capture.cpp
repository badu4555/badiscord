#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
#include <io.h>
#include <fcntl.h>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

class ComInitializeScope {
 public:
  explicit ComInitializeScope(bool initialized) : initialized_(initialized) {}
  ~ComInitializeScope() {
    if (initialized_) CoUninitialize();
  }

 private:
  bool initialized_;
};

class ActivationHandler final : public IActivateAudioInterfaceCompletionHandler {
 public:
  explicit ActivationHandler(HANDLE completedEvent) : completedEvent_(completedEvent) {
    marshalerStatus_ = CoCreateFreeThreadedMarshaler(
        static_cast<IUnknown*>(static_cast<IActivateAudioInterfaceCompletionHandler*>(this)),
        &freeThreadedMarshaler_);
  }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** object) override {
    if (!object) return E_POINTER;
    if (iid == __uuidof(IUnknown) || iid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *object = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
      AddRef();
      return S_OK;
    }
    return freeThreadedMarshaler_
        ? freeThreadedMarshaler_->QueryInterface(iid, object)
        : E_NOINTERFACE;
  }

  ULONG STDMETHODCALLTYPE AddRef() override {
    return ++references_;
  }

  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG remaining = --references_;
    if (remaining == 0) delete this;
    return remaining;
  }

  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT activationStatus = E_UNEXPECTED;
    ComPtr<IUnknown> activatedInterface;
    status_ = operation->GetActivateResult(&activationStatus, &activatedInterface);
    if (SUCCEEDED(status_)) status_ = activationStatus;
    if (SUCCEEDED(status_)) status_ = activatedInterface.As(&audioClient_);
    SetEvent(completedEvent_);
    return S_OK;
  }

  HRESULT status() const { return status_; }
  HRESULT marshalerStatus() const { return marshalerStatus_; }

  HRESULT getAudioClient(IAudioClient** audioClient) {
    if (!audioClient) return E_POINTER;
    return audioClient_.CopyTo(audioClient);
  }

 private:
  std::atomic<ULONG> references_{1};
  HANDLE completedEvent_;
  HRESULT status_ = E_PENDING;
  HRESULT marshalerStatus_ = S_OK;
  ComPtr<IUnknown> freeThreadedMarshaler_;
  ComPtr<IAudioClient> audioClient_;
};

struct AudioStreamHeader {
  char magic[8];
  std::uint32_t sampleRate;
  std::uint32_t channels;
};

static int reportFailure(const char* operation, HRESULT status) {
  std::fprintf(stderr, "%s failed (0x%08lX)\n", operation, static_cast<unsigned long>(status));
  return 1;
}

static int captureProcessAudio(HWND window) {
  DWORD processId = 0;
  if (!GetWindowThreadProcessId(window, &processId) || !processId) {
    std::fprintf(stderr, "The selected window is no longer available.\n");
    return 1;
  }

  const HRESULT comStatus = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(comStatus) && comStatus != RPC_E_CHANGED_MODE) {
    return reportFailure("CoInitializeEx", comStatus);
  }
  ComInitializeScope comScope(SUCCEEDED(comStatus));

  HANDLE activationEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!activationEvent) {
    std::fprintf(stderr, "Could not create the audio activation event.\n");
    return 1;
  }

  auto* handler = new ActivationHandler(activationEvent);
  if (FAILED(handler->marshalerStatus())) {
    const HRESULT marshalerStatus = handler->marshalerStatus();
    handler->Release();
    CloseHandle(activationEvent);
    return reportFailure("CoCreateFreeThreadedMarshaler", marshalerStatus);
  }
  AUDIOCLIENT_ACTIVATION_PARAMS activation = {};
  activation.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  activation.ProcessLoopbackParams.TargetProcessId = processId;
  activation.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activationParameters = {};
  activationParameters.vt = VT_BLOB;
  activationParameters.blob.cbSize = sizeof(activation);
  activationParameters.blob.pBlobData = reinterpret_cast<BYTE*>(&activation);

  ComPtr<IActivateAudioInterfaceAsyncOperation> activationOperation;
  HRESULT status = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
      __uuidof(IAudioClient),
      &activationParameters,
      handler,
      &activationOperation);
  if (FAILED(status)) {
    handler->Release();
    CloseHandle(activationEvent);
    return reportFailure("ActivateAudioInterfaceAsync", status);
  }

  if (WaitForSingleObject(activationEvent, 15000) != WAIT_OBJECT_0) {
    handler->Release();
    CloseHandle(activationEvent);
    std::fprintf(stderr, "Timed out while activating process audio capture.\n");
    return 1;
  }

  status = handler->status();
  ComPtr<IAudioClient> audioClient;
  if (SUCCEEDED(status)) status = handler->getAudioClient(&audioClient);
  handler->Release();
  CloseHandle(activationEvent);
  if (FAILED(status)) {
    return reportFailure("Process audio activation", status);
  }

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
  format.nChannels = 2;
  format.nSamplesPerSec = 48000;
  format.wBitsPerSample = 32;
  format.nBlockAlign = 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  const DWORD streamFlags = AUDCLNT_STREAMFLAGS_LOOPBACK |
      AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
      AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
  status = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, streamFlags, 10000000, 0, &format, nullptr);
  if (FAILED(status)) {
    return reportFailure("IAudioClient::Initialize", status);
  }

  HANDLE sampleReadyEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!sampleReadyEvent) {
    std::fprintf(stderr, "Could not create the audio sample event.\n");
    return 1;
  }

  status = audioClient->SetEventHandle(sampleReadyEvent);
  ComPtr<IAudioCaptureClient> captureClient;
  if (SUCCEEDED(status)) status = audioClient->GetService(IID_PPV_ARGS(&captureClient));
  if (FAILED(status)) {
    CloseHandle(sampleReadyEvent);
    return reportFailure("IAudioClient capture setup", status);
  }

  status = audioClient->Start();
  if (FAILED(status)) {
    CloseHandle(sampleReadyEvent);
    return reportFailure("IAudioClient::Start", status);
  }

  const AudioStreamHeader header = { { 'B', 'D', 'S', 'P', 'C', 'M', '1', '\0' }, 48000, 2 };
  if (std::fwrite(&header, sizeof(header), 1, stdout) != 1 || std::fflush(stdout) != 0) {
    audioClient->Stop();
    CloseHandle(sampleReadyEvent);
    return 1;
  }

  bool outputFailed = false;
  while (WaitForSingleObject(sampleReadyEvent, 250) != WAIT_FAILED) {
    UINT32 packetFrames = 0;
    status = captureClient->GetNextPacketSize(&packetFrames);
    if (FAILED(status)) break;

    while (packetFrames > 0) {
      BYTE* capturedData = nullptr;
      UINT32 frames = 0;
      DWORD bufferFlags = 0;
      status = captureClient->GetBuffer(&capturedData, &frames, &bufferFlags, nullptr, nullptr);
      if (FAILED(status)) break;

      const std::size_t sampleCount = static_cast<std::size_t>(frames) * 2;
      if (bufferFlags & AUDCLNT_BUFFERFLAGS_SILENT) {
        std::vector<float> silence(sampleCount, 0.0f);
        outputFailed = std::fwrite(silence.data(), sizeof(float), sampleCount, stdout) != sampleCount;
      } else {
        outputFailed = std::fwrite(capturedData, sizeof(float), sampleCount, stdout) != sampleCount;
      }
      if (std::fflush(stdout) != 0) outputFailed = true;

      status = captureClient->ReleaseBuffer(frames);
      if (FAILED(status) || outputFailed) break;
      status = captureClient->GetNextPacketSize(&packetFrames);
      if (FAILED(status)) break;
    }
    if (FAILED(status) || outputFailed) break;
  }

  audioClient->Stop();
  CloseHandle(sampleReadyEvent);
  if (outputFailed) return 0;
  return FAILED(status) ? reportFailure("Audio capture", status) : 0;
}

int main(int argc, char** argv) {
  _setmode(_fileno(stdout), _O_BINARY);
  std::setvbuf(stdout, nullptr, _IONBF, 0);
  if (argc != 2) {
    std::fprintf(stderr, "A window handle is required.\n");
    return 2;
  }

  char* end = nullptr;
  const unsigned long long handleValue = std::strtoull(argv[1], &end, 10);
  if (!end || *end != '\0' || handleValue == 0) {
    std::fprintf(stderr, "The selected window handle is invalid.\n");
    return 2;
  }

  return captureProcessAudio(reinterpret_cast<HWND>(static_cast<std::uintptr_t>(handleValue)));
}
