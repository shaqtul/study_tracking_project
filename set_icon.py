import subprocess
import struct
import os

icon_path = os.path.expanduser('~/Desktop/study_tracking_project/StudyFlow.icns')
target_path = os.path.expanduser('~/Desktop/study_tracking_project/index.html')

with open(icon_path, 'rb') as f:
    icns_data = f.read()

# Build the resource fork data with icon
# Use macOS fileicon utility approach via AppleScript
script = f'''
use framework "AppKit"

set iconImage to current application's NSImage's alloc()'s initWithContentsOfFile:"{icon_path}"
set workspace to current application's NSWorkspace's sharedWorkspace()
set result to workspace's setIcon:iconImage forFile:"{target_path}" options:0
return result as boolean
'''

result = subprocess.run(['osascript', '-l', 'AppleScript', '-e', script],
                       capture_output=True, text=True)
if 'true' in result.stdout.lower():
    print('Icon set successfully on index.html')
else:
    print(f'stdout: {result.stdout}')
    print(f'stderr: {result.stderr}')
