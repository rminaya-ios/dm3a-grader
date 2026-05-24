filepath = '/Users/ralphminaya/dm3a-grader/src/App.jsx'

with open(filepath, 'r') as f:
    content = f.read()

old = '        } else {\n          // Auto-detect: one call, Claude identifies all students by name and grades each\n          const batchSystemPrompt = systemPrompt +'

new = '''        } else {
          // Auto-detect: TWO-PASS — boundary detection first, then grade each student individually
          const boundarySystemPrompt = systemPrompt + `
You are scanning a batch of student exams to find student boundaries only.
Return ONLY a JSON array: [{"studentName":"Name","startPage":0,"endPage":2},...]
Page numbers are 0-indexed. Find every student. Return ONLY the JSON array starting with [.`;

          const boundaryUserPrompt = `You are looking at ${batchPageImages.length} pages from a batch scan.
Assignment: ${assignment || "Student Submission"}
${rubric ? `Instructor Rubric Notes: ${rubric}` : ""}
TASK: Find every student name and which pages (0-indexed) belong to them. Separator pages mark new students.
Return ONLY the JSON array of boundaries. Do not grade anything yet.`;

          const boundaryContentBlocks = [
            ...sharedBlocks,
            { type: "text", text: `The following ${batchPageImages.length} pages are the complete batch scan. Each page is labeled.` },
            ...batchPageImages.flatMap((b64, i) => [
              { type: "text", text: `=== PAGE ${i + 1} OF ${batchPageImages.length} ===` },
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }
            ])
          ];

          setLoadingMsg(`Pass 1 of 2 — detecting student boundaries across ${batchPageImages.length} pages...`);
          let boundaries = [];
          try {
            const boundaryRaw = await fetchGradeResult({ contentBlocks: boundaryContentBlocks, systemPrompt: boundarySystemPrompt, userPrompt: boundaryUserPrompt });
            const boundaryCleaned = boundaryRaw.replace(/```json|```/g, "").trim();
            boundaries = JSON.parse(boundaryCleaned);
            if (boundaries.length === 0) throw new Error("No boundaries detected");
          } catch (err) {
            boundaries = [{ studentName: "Unknown Student 1", startPage: 0, endPage: batchPageImages.length - 1 }];
          }

          for (let s = 0; s < boundaries.length; s++) {
            const { studentName, startPage, endPage } = boundaries[s];
            const studentNum = s + 1;
            setLoadingMsg(`Pass 2 — grading ${studentName} (${studentNum} of ${boundaries.length})...`);
            const studentPages = batchPageImages.slice(startPage, endPage + 1);
            const studentContentBlocks = [
              ...sharedBlocks,
              { type: "text", text: `The following ${studentPages.length} pages are ${studentName}s submission only.` },
              ...studentPages.flatMap((b64, i) => [
                { type: "text", text: `=== PAGE ${i + 1} OF ${studentPages.length} ===` },
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }
              ])
            ];
            const studentUserPrompt = `Student: ${studentName}
Assignment: ${assignment || "Student Submission"}
${rubric ? `Instructor Rubric Notes: ${rubric}` : ""}
Grade ALL problems on this student pages using DM3A P1-P4 mastery scoring.
Return a JSON array with exactly ONE student object.`;
            try {
              const raw = await fetchGradeResult({ contentBlocks: studentContentBlocks, systemPrompt, userPrompt: studentUserPrompt });
              const cleaned = raw.replace(/```json|```/g, "").trim();
              const parsed = JSON.parse(cleaned);
              allResults.push(...(Array.isArray(parsed) ? parsed : [parsed]));
            } catch (err) {
              allResults.push({ studentName, overallTier: "P1", error: err.message, dimensions: { conceptualUnderstanding: "P1", problemSolving: "P1", workShown: "P1", accuracy: "P1" }, problems: [], feedback: err.message, strengths: [], growthAreas: [], instructorNote: `Failed on pages ${startPage + 1}-${endPage + 1}.` });
            }
          }
          const batchSystemPrompt ='''

if old in content:
    content = content.replace(old, new, 1)
    with open(filepath, 'w') as f:
        f.write(content)
    print("SUCCESS - App.jsx updated")
else:
    print("ERROR - old block not found")