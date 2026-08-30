import type { SarvamSpeaker } from "../../sarvam/types";

/**
 * A teacher personality: one fixed voice identity (a real person keeps the
 * same voice across languages, so `speaker` doesn't vary with lesson
 * language — only `target_language_code`, set in narrate.ts, does) plus the
 * palette the SVG avatar renderer (avatarRuntime.ts) uses to draw them.
 * Swappable per the "multiple teacher personalities" bonus feature.
 */
export interface TeacherPersona {
  id: string;
  name: string;
  speaker: SarvamSpeaker;
  skinTone: string;
  hairColor: string;
  hairStyle: "bun" | "short" | "flow";
  outfitColor: string;
  accentColor: string;
}

export const TEACHER_PERSONAS: TeacherPersona[] = [
  {
    id: "priya",
    name: "Priya",
    speaker: "priya",
    skinTone: "#c98a5e",
    hairColor: "#2b1a12",
    hairStyle: "bun",
    outfitColor: "#2f6f6b",
    accentColor: "#e8b13a",
  },
  {
    id: "aditya",
    name: "Aditya",
    speaker: "aditya",
    skinTone: "#d9a373",
    hairColor: "#171310",
    hairStyle: "short",
    outfitColor: "#37507c",
    accentColor: "#e07a3f",
  },
  {
    id: "kavya",
    name: "Kavya",
    speaker: "kavya",
    skinTone: "#8a5a3c",
    hairColor: "#0f0b09",
    hairStyle: "flow",
    outfitColor: "#7a3b5e",
    accentColor: "#f2c14e",
  },
];

export const DEFAULT_PERSONA_ID = "priya";

export function getPersona(id?: string): TeacherPersona {
  return TEACHER_PERSONAS.find((p) => p.id === id) ?? TEACHER_PERSONAS.find((p) => p.id === DEFAULT_PERSONA_ID)!;
}
