/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Shield, ShieldAlert, ShieldCheck, User, Lock, Camera, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Configuration
const AUTHORIZED_NAME = "Debanjan Mondal";
const AUTHORIZED_ID = "DEB-8996"; // Example ID
const VERIFICATION_INTERVAL_MIN = 2000; // 2 seconds
const VERIFICATION_INTERVAL_MAX = 5000; // 5 seconds

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [idInput, setIdInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isScanningLogin, setIsScanningLogin] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastVerificationTime, setLastVerificationTime] = useState<number>(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const loginVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Initialize Gemini
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  // Singleton Camera Initialization (Immediate on Mount)
  useEffect(() => {
    let mounted = true;

    const initCamera = async () => {
      try {
        // Request minimal constraints for fastest possible startup
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
            frameRate: { ideal: 30 }
          } 
        });

        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        setIsCameraReady(true);
        
        // Auto-attach to refs if they exist
        if (loginVideoRef.current) loginVideoRef.current.srcObject = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error("Critical: Camera initialization failed:", err);
        setError("Security hardware initialization failed. Please check permissions.");
      }
    };

    initCamera();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Ensure stream is attached whenever refs change
  useEffect(() => {
    if (isCameraReady && streamRef.current) {
      if (loginVideoRef.current && !loginVideoRef.current.srcObject) {
        loginVideoRef.current.srcObject = streamRef.current;
      }
      if (videoRef.current && !videoRef.current.srcObject) {
        videoRef.current.srcObject = streamRef.current;
      }
    }
  }, [isCameraReady, isLoggedIn, isScanningLogin]);

  // Handle Login Authentication (ID + Face Scan)
  const handleInitialAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (idInput.toUpperCase() !== AUTHORIZED_ID) {
      setError("Invalid Security ID.");
      return;
    }

    if (!isScanningLogin) {
      setIsScanningLogin(true);
      setError(null);
      return;
    }

    if (!isCameraReady) {
      setError("Waiting for security hardware...");
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      if (!loginVideoRef.current || !canvasRef.current) return;
      
      const canvas = canvasRef.current;
      const video = loginVideoRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0);
      const base64Image = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];

      const prompt = `Authorized user: ${AUTHORIZED_NAME}. Is the person in this image ${AUTHORIZED_NAME}? Respond ONLY with JSON: {"isAuthorized": boolean, "confidence": number}`;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
          ]
        },
        config: { responseMimeType: "application/json" }
      });

      const responseText = result.text;
      if (responseText) {
        const data = JSON.parse(responseText);
        if (data.isAuthorized && data.confidence > 0.7) {
          setIsLoggedIn(true);
          setIsScanningLogin(false);
          setLastVerificationTime(Date.now());
        } else {
          setError("Biometric Mismatch. Access Denied.");
        }
      }
    } catch (err) {
      console.error("Login verification failed:", err);
      setError("Biometric processing error.");
    } finally {
      setIsVerifying(false);
    }
  };

  // Capture and Verify (Continuous)
  const verifyIdentity = async () => {
    if (!videoRef.current || !canvasRef.current || isLocked || !isLoggedIn) return;

    setIsVerifying(true);

    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      
      if (video.videoWidth === 0) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0);
      const base64Image = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];

      const prompt = `Authorized user: ${AUTHORIZED_NAME}. Is the person in this frame ${AUTHORIZED_NAME}? Respond ONLY with JSON: {"isAuthorized": boolean}`;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
          ]
        },
        config: { responseMimeType: "application/json" }
      });

      const responseText = result.text;
      if (responseText) {
        const data = JSON.parse(responseText);
        if (!data.isAuthorized) {
          setIsLocked(true);
        } else {
          setLastVerificationTime(Date.now());
        }
      }
    } catch (err) {
      console.error("Continuous verification failed:", err);
    } finally {
      setIsVerifying(false);
    }
  };

  // Random Interval Verification
  useEffect(() => {
    if (!isLoggedIn || isLocked) return;

    const scheduleNext = () => {
      const delay = Math.floor(Math.random() * (VERIFICATION_INTERVAL_MAX - VERIFICATION_INTERVAL_MIN)) + VERIFICATION_INTERVAL_MIN;
      return setTimeout(() => {
        verifyIdentity().then(() => {
          if (!isLocked) scheduleNext();
        });
      }, delay);
    };

    const timer = scheduleNext();
    return () => clearTimeout(timer);
  }, [isLoggedIn, isLocked]);

  // Initial verification after login
  useEffect(() => {
    if (isLoggedIn && !isLocked) {
      const timer = setTimeout(verifyIdentity, 500);
      return () => clearTimeout(timer);
    }
  }, [isLoggedIn]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-blue-500/30">
      {/* Hidden elements for capture */}
      <video ref={videoRef} autoPlay playsInline className="hidden" />
      <canvas ref={canvasRef} className="hidden" />

      {/* Lockout Overlay */}
      <AnimatePresence>
        {isLocked && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-6 text-center"
          >
            <ShieldAlert className="w-24 h-24 text-red-600 mb-6 animate-pulse" />
            <h1 className="text-4xl font-bold tracking-tighter mb-4 uppercase">Security Breach Detected</h1>
            <p className="text-gray-500 max-w-md">
              Unauthorized personnel detected. This terminal has been locked to protect sensitive data.
              Please contact your administrator for re-verification.
            </p>
            <button 
              onClick={() => { setIsLocked(false); verifyIdentity(); }}
              className="mt-8 px-8 py-3 bg-white text-black font-bold rounded-full hover:bg-gray-200 transition-colors"
            >
              Retry Verification
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Login Screen */}
      {!isLoggedIn ? (
        <div className="flex items-center justify-center min-h-screen p-4">
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-md bg-[#151515] border border-white/10 rounded-3xl p-10 shadow-2xl"
          >
            <div className="flex justify-center mb-8">
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                <Shield className="w-8 h-8 text-white" />
              </div>
            </div>
            
            <h2 className="text-3xl font-bold text-center mb-2 tracking-tight">Sentinel Access</h2>
            <p className="text-gray-500 text-center mb-10">Enter your security ID to proceed</p>

            <form onSubmit={handleInitialAuth} className="space-y-6">
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input 
                  type="text" 
                  placeholder="Security ID (e.g. DEB-8996)"
                  value={idInput}
                  onChange={(e) => setIdInput(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl py-4 pl-12 pr-4 focus:outline-none focus:border-blue-500 transition-colors"
                  required
                  disabled={isScanningLogin || isVerifying}
                />
              </div>

              <AnimatePresence>
                {isScanningLogin && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="aspect-video bg-black rounded-xl overflow-hidden border border-white/10 relative mb-4">
                      {!isCameraReady && (
                        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]">
                          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                        </div>
                      )}
                      <video 
                        ref={loginVideoRef} 
                        autoPlay 
                        playsInline 
                        muted
                        onLoadedMetadata={() => setIsCameraReady(true)}
                        className={`w-full h-full object-cover grayscale transition-opacity duration-300 ${isCameraReady ? 'opacity-100' : 'opacity-0'}`} 
                      />
                      <div className="absolute inset-0 border-2 border-blue-500/30 rounded-xl pointer-events-none">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-500" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-500" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-500" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-500" />
                      </div>
                      {isVerifying && (
                        <div className="absolute inset-0 bg-blue-600/20 backdrop-blur-[2px] flex items-center justify-center">
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 className="w-8 h-8 animate-spin text-white" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Scanning Biometrics...</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {error && (
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-red-500 text-sm text-center"
                >
                  {error}
                </motion.p>
              )}

              <button 
                type="submit"
                disabled={isVerifying}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-[0.98] flex items-center justify-center gap-2"
              >
                {isVerifying ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : isScanningLogin ? (
                  <>
                    <Camera className="w-5 h-5" />
                    Verify Identity
                  </>
                ) : (
                  "Authenticate"
                )}
              </button>
            </form>

            <div className="mt-8 pt-8 border-t border-white/5 flex items-center justify-center gap-2 text-xs text-gray-600 uppercase tracking-widest">
              <Lock className="w-3 h-3" />
              End-to-End Encrypted Session
            </div>
          </motion.div>
        </div>
      ) : (
        /* Main Dashboard (Mock) */
        <div className="max-w-7xl mx-auto px-6 py-12">
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="px-3 py-1 bg-green-500/10 text-green-500 text-[10px] font-bold uppercase tracking-wider rounded-full border border-green-500/20 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  Secure Session Active
                </span>
              </div>
              <h1 className="text-5xl font-bold tracking-tighter">Welcome back, {AUTHORIZED_NAME.split(' ')[0]}</h1>
            </div>
            
            <div className="flex items-center gap-4 bg-[#151515] border border-white/10 p-4 rounded-2xl">
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-bold tracking-widest">Security Status</p>
                <p className="text-sm font-mono">Last check: {lastVerificationTime ? new Date(lastVerificationTime).toLocaleTimeString() : 'Pending'}</p>
              </div>
            </div>
          </header>

          <main className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Mock Dashboard Cards */}
            <div className="md:col-span-2 space-y-6">
              <div className="bg-[#151515] border border-white/10 rounded-3xl p-8 h-64 flex flex-col justify-end">
                <h3 className="text-2xl font-bold mb-2">System Overview</h3>
                <p className="text-gray-500">All subsystems operational. Continuous monitoring active.</p>
                <div className="mt-6 flex gap-2">
                  {[1,2,3,4,5,6].map(i => (
                    <div key={i} className="h-12 w-full bg-white/5 rounded-lg overflow-hidden relative">
                      <motion.div 
                        initial={{ height: "20%" }}
                        animate={{ height: `${Math.random() * 60 + 20}%` }}
                        transition={{ repeat: Infinity, duration: 2, repeatType: "reverse" }}
                        className="absolute bottom-0 left-0 right-0 bg-blue-600/40"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="bg-[#151515] border border-white/10 rounded-3xl p-8">
                  <p className="text-xs text-gray-500 uppercase font-bold tracking-widest mb-4">Active Connections</p>
                  <p className="text-4xl font-bold tracking-tighter">1,284</p>
                </div>
                <div className="bg-[#151515] border border-white/10 rounded-3xl p-8">
                  <p className="text-xs text-gray-500 uppercase font-bold tracking-widest mb-4">Threats Blocked</p>
                  <p className="text-4xl font-bold tracking-tighter">0</p>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-[#151515] border border-white/10 rounded-3xl p-8">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold">Live Feed</h3>
                  <Camera className="w-4 h-4 text-gray-500" />
                </div>
                <div className="aspect-video bg-black rounded-xl overflow-hidden border border-white/5 relative">
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted
                    className={`w-full h-full object-cover grayscale transition-opacity duration-500 ${isCameraReady ? 'opacity-50' : 'opacity-0'}`} 
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-32 h-32 border border-blue-500/30 rounded-full animate-ping" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-600 mt-4 uppercase tracking-widest text-center">Encrypted Visual Stream</p>
              </div>

              <button 
                onClick={() => {
                  if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                  }
                  setIsLoggedIn(false);
                }}
                className="w-full py-4 rounded-2xl border border-white/10 hover:bg-white/5 transition-colors text-gray-400 font-bold"
              >
                Terminate Session
              </button>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
