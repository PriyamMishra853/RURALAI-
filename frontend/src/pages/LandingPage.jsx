import React from 'react';
import { Link } from 'react-router-dom';
import { Activity, ShieldCheck, HeartPulse, Stethoscope, ArrowRight, AlertTriangle, Users, FileText, CheckCircle2, Mic, Globe2, Sparkles, Building2 } from 'lucide-react';
import ThreeDMedicalCanvas from '../components/ThreeDMedicalCanvas';
import ClinicalUseNotice from '../components/ClinicalUseNotice';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">

      {/* Shown before anything else — a disclaimer below the fold is not a
          disclaimer. Public pages only; never on an authenticated view. */}
      <ClinicalUseNotice variant="strip" />

      {/* HERO SECTION WITH 3D CANVAS ANIMATION */}
      <section className="relative pt-12 pb-16 overflow-hidden px-4 lg:px-8 border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">
          
          {/* Left Hero Text */}
          <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
              <Sparkles className="w-4 h-4 text-blue-600" />
              AI-Powered Virtual Clinic Platform for Rural Healthcare
            </div>

            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-tight">
              Bringing AI-Assisted Healthcare <br />
              <span className="text-blue-600">
                Closer to Rural Communities.
              </span>
            </h1>

            <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-2xl">
              Empowering village health assistants across India to digitally collect patient information, capture symptoms & vitals, digitize paper prescriptions via OCR, analyze injury photos, and prepare structured doctor-ready cases using verified MoHFW clinical protocols.
            </p>

            {/* Central Product Principle */}
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 shadow-sm max-w-xl">
              <span className="text-xs uppercase tracking-wider font-bold text-blue-700 block mb-1">Central Product Principle</span>
              <span className="text-base font-bold text-slate-900">AI prepares the case. The doctor makes the medical decision.</span>
            </div>

            {/* Login Actions */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3 pt-2">
              <Link
                to="/login?role=CLINIC_ASSISTANT"
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm transition-colors flex items-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" /> Clinic Assistant Login
              </Link>
              <Link
                to="/login?role=DOCTOR"
                className="px-5 py-2.5 rounded-lg bg-white hover:bg-slate-50 text-emerald-700 font-semibold text-xs border border-slate-200 shadow-sm transition-colors flex items-center gap-2"
              >
                <Stethoscope className="w-4 h-4" /> Doctor Login
              </Link>
              <Link
                to="/login?role=ADMIN"
                className="px-5 py-2.5 rounded-lg bg-white hover:bg-slate-50 text-purple-700 font-semibold text-xs border border-slate-200 shadow-sm transition-colors flex items-center gap-2"
              >
                <Users className="w-4 h-4" /> Admin Login
              </Link>
            </div>
          </div>

          {/* Right 3D Interactive WebGL Canvas */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="w-full max-w-md bg-slate-50 p-4 rounded-lg border border-slate-200 shadow-sm relative">
              <div className="absolute top-3 left-4 text-xs font-bold text-slate-700 flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-blue-600" />
                India Telemedicine Grid
              </div>
              <ThreeDMedicalCanvas />
            </div>
          </div>

        </div>

        {/* Prominent Mandatory Safety Notice */}
        <div className="mt-8 max-w-5xl mx-auto p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs sm:text-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong className="text-amber-950 font-bold">Safety & Legal Position Notice: </strong>
            AI assistance does not replace professional medical diagnosis or treatment. Final clinical decisions are made by qualified healthcare professionals.
          </div>
        </div>
      </section>

      {/* INDIA-LEVEL IMPACT STATS BANNER */}
      <section className="py-8 bg-slate-100 border-b border-slate-200 px-4 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-sm">
            <div className="text-2xl font-bold text-blue-600">142</div>
            <div className="text-xs text-slate-500 font-medium mt-1">Village Clinics Connected</div>
          </div>
          <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-sm">
            <div className="text-2xl font-bold text-emerald-600">12</div>
            <div className="text-xs text-slate-500 font-medium mt-1">Indian States Covered</div>
          </div>
          <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-sm">
            <div className="text-2xl font-bold text-purple-600">4,820+</div>
            <div className="text-xs text-slate-500 font-medium mt-1">Rural Patients Served</div>
          </div>
          <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-sm">
            <div className="text-2xl font-bold text-amber-600">4.2 Mins</div>
            <div className="text-xs text-slate-500 font-medium mt-1">Avg Doctor Response Time</div>
          </div>
        </div>
      </section>

      {/* PROBLEM vs SOLUTION SECTION */}
      <section className="py-12 px-4 lg:px-8 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Core Problem */}
          <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center mb-2 border border-red-100">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Rural Healthcare Challenges</h2>
            <ul className="space-y-2 text-xs text-slate-700">
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-bold">•</span>
                <span>Severe shortage of qualified doctors in remote sub-centres and Primary Health Centres (PHCs).</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-bold">•</span>
                <span>Patients travel several hours over difficult rural terrain to reach district hospitals.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-bold">•</span>
                <span>Paper-based prescriptions lead to lost medical history and repeated diagnostic costs.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-bold">•</span>
                <span>Language and literacy barriers prevent accurate symptom communication.</span>
              </li>
            </ul>
          </div>

          {/* Solution */}
          <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-2 border border-blue-100">
              <HeartPulse className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">The Virtual Clinic Solution</h2>
            <ul className="space-y-2 text-xs text-slate-700">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>Multilingual Voice Input:</strong> Assistant records symptoms in native dialect (Hindi, Tamil, Telugu, etc.).</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>OCR & Document Digitization:</strong> Upload old paper prescriptions with mandatory human verification.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>MoHFW RAG & Protocol Engine:</strong> Retrieves approved Indian government clinical guidelines for safety.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>Doctor-in-the-Loop Teleconsultation:</strong> Structured handoff to remote doctors via encrypted video calls.</span>
              </li>
            </ul>
          </div>

        </div>
      </section>

      {/* 6-STEP PRODUCT WORKFLOW */}
      <section className="py-12 px-4 lg:px-8 max-w-7xl mx-auto w-full border-t border-slate-200">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-slate-900">How The Virtual Clinic Works</h2>
          <p className="text-slate-500 text-xs mt-1">End-to-End Clinical Journey</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          {[
            { step: '1', title: 'Register Patient', desc: 'Assistant creates patient code & preferred language.', icon: <Users className="w-4 h-4 text-blue-600" /> },
            { step: '2', title: 'Capture Data', desc: 'Symptoms via Voice, Vitals, Prescription OCR, & Injury photos.', icon: <Mic className="w-4 h-4 text-emerald-600" /> },
            { step: '3', title: 'AI Assesses', desc: 'Groq LLM + Qdrant RAG retrieve approved MoHFW protocols.', icon: <FileText className="w-4 h-4 text-purple-600" /> },
            { step: '4', title: 'Risk Detected', desc: 'Safety rules triage into GREEN, YELLOW, or RED EMERGENCY.', icon: <AlertTriangle className="w-4 h-4 text-amber-600" /> },
            { step: '5', title: 'Doctor Reviews', desc: 'Qualified doctor inspects AI summary, vitals, OCR, & Video call.', icon: <Stethoscope className="w-4 h-4 text-blue-600" /> },
            { step: '6', title: 'Professional Care', desc: 'Doctor issues signed digital prescription & treatment record.', icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" /> }
          ].map((item, idx) => (
            <div key={idx} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="w-6 h-6 rounded bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center border border-slate-200">
                    {item.step}
                  </span>
                  {item.icon}
                </div>
                <h3 className="text-xs font-bold text-slate-900 mb-1">{item.title}</h3>
                <p className="text-[11px] text-slate-500 leading-normal">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mt-auto py-6 px-4 border-t border-slate-200 text-center text-xs text-slate-500 bg-white">
        Virtual Village Clinic — Grounded in MoHFW Standard Treatment Guidelines & Telemedicine Practice Guidelines.
      </footer>
    </div>
  );
}
