import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Sidebar, SidebarLinks } from "@/components/sidebar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: "Contigo Ranch · AI Front Desk", description: "Danny's calls, bookings, evals and versions" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full font-sans">
        <Suspense fallback={<SidebarLinks path="" />}><Sidebar /></Suspense>
        <main className="min-w-0 flex-1 p-6"><div className="mx-auto w-full max-w-7xl">{children}</div></main>
      </body>
    </html>
  );
}
