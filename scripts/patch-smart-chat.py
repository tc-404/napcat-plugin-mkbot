# -*- coding: utf-8 -*-
path = r'C:\ProgramData\NapCatQQ Desktop\runtime\MKbot14\MK\src\mkbot-core.ts'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()
start = end = None
for i, line in enumerate(lines):
    if 'AI对话功能会使用大量的token' in line and start is None:
        # back up to comment divider
        j = i
        while j > 0 and lines[j].strip() != '// ---------------------------------------------------------------------------':
            j -= 1
        start = j
    if start is not None and line.strip() == '*/' and i > start:
        end = i
        break
print('start', start + 1 if start is not None else None, 'end', end + 1 if end is not None else None)
if start is None or end is None:
    raise SystemExit('block not found')
new = [
    '\n',
    '// ================== 智能对话（见 ./auth/smart-chat.ts） ==================\n',
    'try {\n',
    '    await smartChatIngest(smartChatDeps, event);\n',
    '} catch (smartChatErr) {\n',
    "    logger?.error?.('[智能对话] ingest 异常:', smartChatErr);\n",
    '}\n',
    '\n',
]
lines = lines[:start] + new + lines[end + 1:]
with open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(lines)
print('ok')
