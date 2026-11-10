import { NextResponse, type NextRequest } from 'next/server';
import { baseUrl } from '@/lib/http';
import { COOKIE } from '@/lib/session';

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(`${baseUrl(req)}/`);
  res.cookies.delete(COOKIE);
  return res;
}
