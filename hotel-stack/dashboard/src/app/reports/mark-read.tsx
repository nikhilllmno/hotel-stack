"use client";

import { useEffect } from "react";
import { markRead } from "./actions";

export function MarkRead({ id, unread }: { id: number; unread: boolean }) {
  useEffect(() => { if (unread) markRead(id); }, [id, unread]);
  return null;
}
