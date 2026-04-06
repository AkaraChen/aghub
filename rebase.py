import subprocess
import os

proc = subprocess.run(["git", "log", "origin/main..HEAD", "--oneline"], capture_output=True, text=True)
lines = proc.stdout.strip().split('\n')
lines.reverse() # chronologically

# we want to squash style: fmt into chore(desktop)...
# and apply fixups automatically
output = []
chore_desktop_hash = ""
feat_api_hash = ""

for line in lines:
    parts = line.split(" ", 1)
    sha = parts[0]
    msg = parts[1]
    
    if "feat(core)" in msg:
        output.append(f"pick {sha}")
    elif "feat(api)" in msg and not "fixup!" in msg:
        output.append(f"pick {sha}")
        feat_api_hash = sha
    elif "fixup! feat(api)" in msg:
        # Move up to fixup feat_api
        pass
    elif "chore(desktop)" in msg and not "fixup!" in msg:
        output.append(f"pick {sha}")
        chore_desktop_hash = sha
    elif "fixup! chore(desktop)" in msg:
        pass
    elif "style: fmt" in msg:
        pass
    else:
        output.append(f"pick {sha}")

# apply fixups
new_output = []
for line in output:
    new_output.append(line)
    if feat_api_hash in line:
        for l in lines:
            if "fixup! feat(api)" in l:
                new_output.append(f"fixup {l.split(' ')[0]}")
    if chore_desktop_hash in line:
        for l in lines:
            if "style: fmt" in l:
                new_output.append(f"fixup {l.split(' ')[0]}")
            if "fixup! chore(desktop)" in l:
                new_output.append(f"fixup {l.split(' ')[0]}")

with open("git-editor.sh", "w") as f:
    f.write("#!/bin/bash\n")
    f.write("cat << 'INNEREOF' > \"$1\"\n")
    f.write("\n".join(new_output) + "\n")
    f.write("INNEREOF\n")
os.chmod("git-editor.sh", 0o755)

