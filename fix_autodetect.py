with open('/Users/ralphminaya/dm3a-grader/src/App.jsx', 'r') as f:
    content = f.read()

old_block = '        } else {\n          // Auto-detect: one call, Claude identifies all students by name and grades each\n          const batchSystemPrompt = systemPrompt +'

if old_block in content:
    print("Found - proceeding")
else:
    print("NOT FOUND - stopping")
    exit(1)
