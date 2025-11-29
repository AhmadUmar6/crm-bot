/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://crmrebs-backend-746815019501.europe-west1.run.app/api/:path*',
      },
    ];
  },
};

export default nextConfig;
