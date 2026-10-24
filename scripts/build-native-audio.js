const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  console.warn('Skipping the process-audio capture helper; it is supported only on Windows.');
  process.exit(0);
}

const vswherePath = path.join(
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Microsoft Visual Studio',
  'Installer',
  'vswhere.exe'
);
if (!fs.existsSync(vswherePath)) {
  throw new Error('Visual Studio Build Tools are required to build the process-audio capture helper.');
}

const vswhere = spawnSync(vswherePath, [
  '-latest',
  '-products',
  '*',
  '-requires',
  'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
  '-property',
  'installationPath'
], { encoding: 'utf8' });
if (vswhere.status !== 0 || !vswhere.stdout.trim()) {
  throw new Error('Install the Visual C++ x64 build tools and Windows SDK before building BADISCORD.');
}

const vcvarsPath = path.join(vswhere.stdout.trim(), 'Common7', 'Tools', 'VsDevCmd.bat');
const sourcePath = path.join(__dirname, '..', 'native', 'process-audio-capture.cpp');
const outputPath = path.join(__dirname, '..', 'native', 'process-audio-capture.exe');
const objectPath = path.join(__dirname, '..', 'native', 'process-audio-capture.obj');
const command = `call "${vcvarsPath}" -arch=x64 -host_arch=x64 >nul && cl /nologo /O2 /EHsc /std:c++17 /MT /DWIN32_LEAN_AND_MEAN "${sourcePath}" /Fo"${objectPath}" /link ole32.lib uuid.lib mmdevapi.lib user32.lib /OUT:"${outputPath}"`;
const build = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', command], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  windowsVerbatimArguments: true
});

if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);
fs.rmSync(objectPath, { force: true });
console.log(`Built ${outputPath}`);
