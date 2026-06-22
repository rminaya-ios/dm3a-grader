// scripts/seedRiskData.js
// DM3A Grader — Risk Predictor Seed Script
// Seeds test submissions that trigger each of the 6 risk rules.
// Run: node scripts/seedRiskData.js
// Requires: MONGODB_URI in environment (or .env file)

require('dotenv/config');
const mongoose = require('mongoose');
const Submission = require('../models/Submission.js');
const AtRiskFlag = require('../models/AtRiskFlag.js');

const COURSE     = 'MATH110-03';
const PROFESSOR  = 'rminaya@usj.edu';
const SEMESTER   = 'Spring2026';

const students = [
  // R2: Two consecutive P1s
  {
    email: 'test.r2@dm3a.dev',
    name:  'Rule Two Student',
    submissions: [
      { name: 'HW3 - Hypothesis Testing', weight: 'homework', index: 3, pScore: 1, daysAgo: 5 },
      { name: 'HW2 - Normal Distribution', weight: 'homework', index: 2, pScore: 1, daysAgo: 12 },
      { name: 'HW1 - Descriptive Stats',   weight: 'homework', index: 1, pScore: 3, daysAgo: 19 },
    ],
  },
  // R3: Declining trend P3 → P2 → P1
  {
    email: 'test.r3@dm3a.dev',
    name:  'Rule Three Student',
    submissions: [
      { name: 'Quiz 2 - Probability',       weight: 'quiz',     index: 4, pScore: 1, daysAgo: 3  },
      { name: 'HW2 - Normal Distribution',  weight: 'homework', index: 3, pScore: 2, daysAgo: 10 },
      { name: 'HW1 - Descriptive Stats',    weight: 'homework', index: 2, pScore: 3, daysAgo: 17 },
    ],
  },
  // R4: High-weight P1 (exam)
  {
    email: 'test.r4@dm3a.dev',
    name:  'Rule Four Student',
    submissions: [
      { name: 'Midterm Exam', weight: 'midterm', index: 5, pScore: 1, daysAgo: 2 },
      { name: 'HW2 - Z-Scores', weight: 'homework', index: 4, pScore: 3, daysAgo: 9 },
    ],
  },
  // R6: P1 on first assignment
  {
    email: 'test.r6@dm3a.dev',
    name:  'Rule Six Student',
    submissions: [
      { name: 'HW1 - Descriptive Statistics', weight: 'homework', index: 1, pScore: 1, daysAgo: 6 },
    ],
  },
  // R1: Inactivity (last submission 8 days ago)
  {
    email: 'test.r1@dm3a.dev',
    name:  'Rule One Student',
    submissions: [
      { name: 'HW2 - Sampling Methods', weight: 'homework', index: 2, pScore: 2, daysAgo: 8 },
      { name: 'HW1 - Intro to Stats',   weight: 'homework', index: 1, pScore: 3, daysAgo: 15 },
    ],
  },
  // On track — should NOT trigger any flag
  {
    email: 'test.ok@dm3a.dev',
    name:  'On Track Student',
    submissions: [
      { name: 'HW3 - Confidence Intervals', weight: 'homework', index: 3, pScore: 4, daysAgo: 2 },
      { name: 'HW2 - Normal Distribution',  weight: 'homework', index: 2, pScore: 3, daysAgo: 9 },
      { name: 'HW1 - Descriptive Stats',    weight: 'homework', index: 1, pScore: 3, daysAgo: 16 },
    ],
  },
];

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const rubric = (pScore) => {
  // Generate plausible rubric breakdown for a given pScore
  const base = pScore;
  return {
    conceptualUnderstanding: Math.max(1, Math.min(4, base + (Math.random() > 0.5 ? 0 : -1))),
    problemSolving:          Math.max(1, Math.min(4, base)),
    workShown:               Math.max(1, Math.min(4, base + (Math.random() > 0.5 ? 0 : 1))),
    accuracy:                Math.max(1, Math.min(4, base + (Math.random() > 0.5 ? 0 : -1))),
  };
};

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clean previous seed data
    await Submission.deleteMany({ courseCode: COURSE, studentEmail: /test\..+@dm3a\.dev/ });
    await AtRiskFlag.deleteMany({ courseCode: COURSE, studentEmail: /test\..+@dm3a\.dev/ });
    console.log('🧹 Cleaned previous seed data');

    for (const student of students) {
      console.log(`\n📝 Seeding: ${student.name} (${student.email})`);

      for (const sub of student.submissions) {
        await Submission.create({
          studentEmail:    student.email,
          studentName:     student.name,
          professorEmail:  PROFESSOR,
          courseCode:      COURSE,
          assignmentName:  sub.name,
          assignmentWeight: sub.weight,
          assignmentIndex: sub.index,
          pScore:          sub.pScore,
          pLabel:          `P${sub.pScore}`,
          rubricBreakdown: rubric(sub.pScore),
          submittedAt:     daysAgo(sub.daysAgo),
          semesterTag:     SEMESTER,
        });
        console.log(`   ✔ ${sub.name} — P${sub.pScore} (${sub.daysAgo} days ago)`);
      }
    }

    console.log('\n✅ Seed complete. Now run the risk evaluator against each test student:');
    console.log('   GET /api/risk/flags?professorEmail=rminaya@usj.edu&courseCode=MATH110-03');
    console.log('\n   Expected flags:');
    console.log('   🔴 test.r2@dm3a.dev  — R2 (consecutive P1s)');
    console.log('   🔴 test.r3@dm3a.dev  — R3 (declining trend)');
    console.log('   🔴 test.r4@dm3a.dev  — R4 (high-weight P1)');
    console.log('   🔴 test.r6@dm3a.dev  — R6 (first assignment P1)');
    console.log('   🟡 test.r1@dm3a.dev  — R1 (7-day inactivity)');
    console.log('   ✅ test.ok@dm3a.dev  — No flag (on track)');
  } catch (err) {
    console.error('❌ Seed error:', err.message);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed.');
  }
};

run();
