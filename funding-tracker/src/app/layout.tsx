import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Club Funding Tracker",
  description: "One master view of student-club funding across every campus source.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
