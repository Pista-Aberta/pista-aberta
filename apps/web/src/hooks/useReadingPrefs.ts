import { useEffect, useState } from "react";

/** Preferencias Aa (contraste / tamaño) compartidas por todas as cabeceiras.
 * REVISION-54 E5: a query (?contraste/?texto) léese en main.tsx. */

function readInitialContrast(): boolean {
  return localStorage.getItem("pa_contrast") === "high";
}

function readInitialText(): string {
  return localStorage.getItem("pa_text") ?? "100";
}

export function useReadingPrefs() {
  const [aaOpen, setAaOpen] = useState(false);
  const [contrast, setContrast] = useState(readInitialContrast);
  const [textStep, setTextStep] = useState(readInitialText);

  useEffect(() => {
    document.documentElement.dataset.contrast = contrast ? "high" : "normal";
    localStorage.setItem("pa_contrast", contrast ? "high" : "normal");
  }, [contrast]);

  useEffect(() => {
    if (textStep === "100") delete document.documentElement.dataset.text;
    else document.documentElement.dataset.text = textStep;
    localStorage.setItem("pa_text", textStep);
  }, [textStep]);

  const cycleText = () =>
    setTextStep((s) => (s === "100" ? "125" : s === "125" ? "150" : "100"));

  return {
    aaOpen,
    setAaOpen,
    contrast,
    setContrast,
    textStep,
    cycleText,
  };
}
