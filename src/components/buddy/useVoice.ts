import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Speech in and out for Buddy.
 *
 * Input stops itself after a short pause, since Chrome only ends a continuous
 * session after its own long silence timeout. Output picks the least synthetic
 * English voice the browser has.
 */
export function useVoice(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [autoSpeak, setAutoSpeakState] = useState(false);
  const recognitionRef = useRef<any>(null);
  const silenceRef = useRef<number | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const supported =
    typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    let finalText = "";
    let fullText = "";
    recognitionRef.current = recognition;

    const arm = () => {
      if (silenceRef.current) window.clearTimeout(silenceRef.current);
      silenceRef.current = window.setTimeout(() => {
        try {
          recognition.stop();
        } catch {
          /* already stopped */
        }
      }, 1600);
    };

    recognition.onstart = () => setListening(true);
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += `${t} `;
        else interim = t;
      }
      fullText = `${finalText}${interim}`.trim();
      setTranscript(fullText);
      arm();
    };
    recognition.onend = () => {
      if (silenceRef.current) window.clearTimeout(silenceRef.current);
      setListening(false);
      setTranscript("");
      const text = fullText || finalText.trim();
      if (text) onFinalRef.current(text);
    };
    recognition.onerror = (e: any) => {
      setListening(false);
      setTranscript("");
      if (e.error !== "no-speech" && e.error !== "aborted") toast.error(`Microphone error: ${e.error}`);
    };
    recognition.start();
  }, []);

  const stop = useCallback(() => recognitionRef.current?.stop(), []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      const score = (v: SpeechSynthesisVoice) => {
        const n = v.name.toLowerCase();
        if (!v.lang.toLowerCase().startsWith("en")) return -1;
        let s = 0;
        if (/google|natural|neural|premium|enhanced/.test(n)) s += 6;
        if (/female|samantha|zira|aria|jenny|sonia|libby|serena|karen|moira|tessa|fiona/.test(n)) s += 4;
        if (!v.localService) s += 2;
        if (/en-gb|en-in/.test(v.lang.toLowerCase())) s += 1;
        return s;
      };
      voiceRef.current = voices.map((v) => ({ v, s: score(v) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.v ?? null;
    };
    pick();
    window.speechSynthesis.addEventListener("voiceschanged", pick);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", pick);
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const clean = text
      .replace(/\|/g, " ")
      .replace(/\*\*|__|~~|\[([^\]]+)\]\([^)]+\)|`{1,3}[^`]*`{1,3}|#{1,6}\s/g, "$1")
      .trim();
    const utt = new SpeechSynthesisUtterance(clean);
    if (voiceRef.current) {
      utt.voice = voiceRef.current;
      utt.lang = voiceRef.current.lang;
    } else {
      utt.lang = "en-IN";
    }
    utt.rate = 0.98;
    utt.pitch = 1.05;
    window.speechSynthesis.speak(utt);
  }, []);

  const setAutoSpeak = useCallback((on: boolean) => {
    setAutoSpeakState(on);
    if (!on && typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    },
    [],
  );

  return { supported, listening, transcript, start, stop, speak, autoSpeak, setAutoSpeak };
}
