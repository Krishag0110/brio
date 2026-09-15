import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "brio · Customer to Engineering",
  description:
    "Customer cases, persona policy, approvals, and verified reply outcomes.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
