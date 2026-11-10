export const metadata = { title: 'מכרזים' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="he" dir="rtl"><body>{children}</body></html>);
}
