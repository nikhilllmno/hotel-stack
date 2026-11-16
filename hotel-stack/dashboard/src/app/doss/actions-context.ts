"use client";

import { createContext } from "react";
import type { Approval, Question } from "@/lib/doss-events";

/** Actions the chat cards call: answer an approval, answer one of Doss's questions. */
export const DossActions = createContext<{
  answer: (a: Approval, choice: string) => Promise<void>;
  answerQuestion: (q: Question, answer: string) => Promise<void>;
}>({ answer: async () => {}, answerQuestion: async () => {} });
