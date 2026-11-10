import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/', destination: '/app.html' }];
  },
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }, { key: 'Referrer-Policy', value: 'same-origin' }] }];
  },
  serverExternalPackages: ['pg', 'jszip'],
};
export default nextConfig;
