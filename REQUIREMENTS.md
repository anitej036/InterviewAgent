# InterviewAgent - Chrome Extension Requirements

## Product Overview
A Chrome Extension that acts as an AI co-pilot for interviewers during Google Meet interviews.
The AI agent listens to the entire interview, assesses candidate answers in real-time, and generates a final hiring report.

## Core Features

### 1. Resume Parsing
- Interviewer uploads candidate's PDF resume before the interview
- Agent extracts and displays the main technical/professional skills
- Skills become the foundation for question generation and final assessment

### 2. Question Suggestion
- Based on extracted skills, agent generates a question bank per skill
- Questions organized by skill category
- Interviewer can browse and pick questions to ask

### 3. Real-Time Conversation Listening & Assessment
- Agent continuously listens to the Google Meet audio
- Detects when interviewer asks a question
- Detects when candidate answers
- Assesses the quality of the candidate's answer
- Suggests follow-up questions based on the answer

### 4. Flexible Interview Flow
- Interviewer can use agent's suggested questions OR ask their own
- Agent listens and judges regardless of which questions are asked
- No rigid structure imposed on the interviewer

### 5. Topic Switch Tracking
- Interview can jump between different skill areas
- Agent keeps track of all topics covered
- Marks coverage depth per topic

### 6. End-of-Interview Candidate Judgment
- Agent evaluates candidate on every skill from the resume
- Gives scores or ratings per skill
- Based on conversation evidence, not guesswork

### 7. Final Report Generation
- Brief, actionable report
- Candidate performance summary
- Hire / No Hire recommendation
- Strengths identified during interview
- Areas needing improvement
- Key moments from the interview as evidence

## User Flow
1. Interviewer opens Google Meet call
2. Extension side panel opens
3. Interviewer uploads resume → skills extracted → question bank generated
4. Interview starts → agent begins listening
5. Live transcript shown + real-time assessments + follow-up suggestions
6. Interview ends → agent generates full report
7. Interviewer reviews and can export/save the report

## Technical Constraints
- Chrome Extension (Manifest V3)
- Works on meet.google.com
- Real-time audio transcription
- Claude AI for all intelligence
- No separate backend server required
