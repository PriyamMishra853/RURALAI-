# 🏥 AI-Assisted Virtual Village Clinic Platform

> **Central Product Principle:**  
> **"AI prepares the case. The doctor makes the medical decision."**

An AI-assisted Virtual Village Clinic platform designed for trained village health assistants across rural India to digitally capture patient demographics, record symptoms & vitals, digitize paper prescriptions via OCR, analyze injury photos, receive AI-assisted preliminary risk classifications based on Ministry of Health & Family Welfare (MoHFW) approved clinical protocols, and connect patients with remote qualified doctors via HD video teleconsultations.

---

## 🌟 Key Features

- **🎙️ Multilingual Speech Input with Auto-Language Detection**: Spoken symptoms in Hindi, Tamil, Telugu, Marathi, Bengali, or English are transcribed and converted into structured medical data automatically powered by Groq Whisper AI.
- **📄 Prescription & Lab Report OCR with Mandatory Human Verification**: Upload paper prescriptions or medical reports using Tesseract OCR & Groq Multimodal Vision with side-by-side mandatory clinic assistant verification before saving.
- **🧠 Groq LLM + Qdrant Cloud RAG Clinical Protocol Engine**: Queries approved MoHFW Standard Treatment Guidelines (metadata `approved = true`) to output structured patient summaries and step-by-step approved first-aid guidance.
- **🛡️ Rule-Based Safety Triage Engine**: Segregates cases into **LOW (Green)**, **MODERATE (Yellow)**, **HIGH (Orange)**, and **EMERGENCY (Red)** risk levels with automated red-flag detection.
- **📹 Peer-to-Peer WebRTC Video Teleconsultation**: Instant WebRTC video call between village sub-centre clinic assistant and remote doctor.
- **📊 India-Level Rural Health Admin Analytics**: Real-time national metrics across 142 tele-clinics in 12 states, risk distribution breakdown, and qualified doctor roster management.
- **☀️🌙 Light & Dark Minimalist UI with Dynamic Cursor Shader**: Sleek glassmorphic theme with a cursor-following dynamic radial mesh gradient.
- **📄 Printable Clinical Summary PDF Export**: 1-click formatted PDF export of complete patient case file.

---

## 🏗️ Architecture & Tech Stack

```
                               ┌──────────────────────────────────────────────┐
                               │       React (Vite) + Tailwind CSS SPA        │
                               │  - 3D Interactive WebGL Globe (Three.js)     │
                               │  - Light/Dark Minimalist Theme               │
                               └──────────────────────┬───────────────────────┘
                                                      │ HTTP / REST
                               ┌──────────────────────▼───────────────────────┐
                               │           Node.js Express API Server          │
                               └──────┬───────────────┬───────────────┬───────┘
                                      │               │               │
            ┌─────────────────────────▼──┐   ┌────────▼────────┐   ┌──▼──────────────────────────┐
            │   Hosted Supabase DB       │   │  Groq Cloud AI  │   │     Qdrant Vector Cloud     │
            │   (PostgreSQL 19 Tables)   │   │  (Whisper/LLM)  │   │ (MoHFW Approved Protocols)  │
            └────────────────────────────┘   └─────────────────┘   └─────────────────────────────┘
```

- **Frontend**: React 18, Vite, Tailwind CSS, Three.js, Lucide Icons, Framer Motion, native WebRTC.
- **Backend**: Node.js, Express.js, JWT Authentication, Multer file upload.
- **Database & Storage**: PostgreSQL via hosted Supabase (`supabase-js`).
- **AI & RAG Engine**: Groq Cloud (`llama-3.3-70b-versatile`, `llama-3.2-11b-vision-preview`, `whisper-large-v3-turbo`), Qdrant Cloud Vector Database (`@qdrant/js-client-rest`).
- **OCR Engine**: Tesseract.js & Groq Multimodal Vision.

---

## 🗺️ Implementation Plan

### 1. Database Schema & Safety Policies (`/database`)
- `schema.sql`: 19 relational tables including `clinics`, `profiles`, `patients`, `visits`, `vitals`, `medical_documents`, `document_extractions`, `patient_images`, `knowledge_sources`, `protocols`, `ai_assessments`, `doctor_reviews`, `prescriptions`, `audit_logs`.
- `seed.sql`: Seed data for 142 rural clinics, 5 qualified doctor accounts, MoHFW approved clinical protocols, and 4 sample patient cases across UP, Bihar, MP, and West Bengal.

### 2. Backend Microservices & Controllers (`/backend`)
- Auth Controller: JWT token issuance with role-based authorization (`CLINIC_ASSISTANT`, `DOCTOR`, `ADMIN`).
- Patient & Visit Controller: Patient registration, ABHA number linking, clinical visit initiation, and vitals recording with empty-value safety checks.
- AI & RAG Orchestrator (`aiOrchestrator.js` & `ragEngine.js`): Executes rule-based triage, queries Qdrant Cloud vector DB for approved protocols, and calls Groq LLM for clinical handoff summaries & supportive medication guidance.
- OCR Service (`ocrService.js`): Multimodal document reading with mandatory human confirmation modal.
- Speech Service (`speechService.js`): Multilingual Whisper speech transcription with automatic language identification.

### 3. Frontend Web Application (`/frontend`)
- Landing Page (`/`): Product vision, safety notice, 6-step workflow, and 3D WebGL interactive node canvas.
- Clinic Assistant Workspace (`/assistant/dashboard`): Real-time village patient directory, register patient modal, and 5-step visit assessment wizard.
- Remote Doctor Workspace (`/doctor/queue`): Triage queue sorted by risk level, explicit AI assistance vs Doctor decision visual separation, WebRTC video calls, and signed digital prescription submission.
- Admin Panel (`/admin/dashboard`): India-level village analytics, state coverage breakdown, doctor roster provisioning, protocol ingestion to Qdrant, and compliance audit logs.

---

## 🚀 Setup & Running Guide

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### 1. Clone & Configure Environment Variables
```bash
git clone https://github.com/Ashish42-droid/BOB.git
cd BOB
```

Create a `.env` file in `backend/.env`:
```env
PORT=5000
JWT_SECRET=            # generate with: openssl rand -base64 48

# Supabase Credentials
SUPABASE_URL=https://ucivhqksbbwhdwetrkbd.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# AI API Credentials
GROQ_API_KEY=your_groq_api_key
QDRANT_URL=https://cc6c04a5-4d82-4ada-83db-a20f1cddccb6.sa-east-1-0.aws.cloud.qdrant.io
QDRANT_API_KEY=your_qdrant_api_key

# Video Teleconsultation (peer-to-peer WebRTC — no third-party SDK)
# TURN is required for calls between different networks.
TURN_URL=
TURN_USERNAME=
TURN_CREDENTIAL=
```

Create a `.env` file in `frontend/.env`:
```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_TURN_URL=
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

### 2. Install Dependencies & Start Backend Server
```bash
cd backend
npm install
node src/server.js
```
The backend API server will start on `http://localhost:5000/api`.

### 3. Install Dependencies & Start Frontend Dev Server
```bash
cd ../frontend
npm install
npm run dev
```
The frontend web application will start on `http://localhost:3000`.

---

## 🔑 Demo Role-Based Login Credentials

For testing and evaluation, click **Role Login** on the homepage or log in using these preset credentials:

| Role | Email | Password | Access Rights |
| :--- | :--- | :--- | :--- |
| **Clinic Assistant** | `assistant@clinic.org` | *Any / demo* | Register patients, record vitals, upload OCR prescriptions, run AI assessment |
| **Doctor** | `doctor@clinic.org` | *Any / demo* | View priority consultation queue, launch WebRTC video calls, issue signed prescriptions |
| **Admin** | `admin@clinic.org` | *Any / demo* | View India-level analytics, manage doctor roster, ingest protocols into Qdrant, view audit logs |

---

## 🛡️ Safety & Legal Notice

> AI assistance does not replace professional medical diagnosis or treatment. All clinical decisions, prescriptions, and referrals are made strictly by qualified healthcare professionals registered under the National Medical Commission (NMC) of India.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.
