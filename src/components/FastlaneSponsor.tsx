import React from 'react';
import Image from 'next/image';

interface FastlaneSponsorProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export default function FastlaneSponsor({ size = 'md', showText = true }: FastlaneSponsorProps) {
  // Size mapping for the logo container
  const sizeClasses = {
    sm: 'w-[80px] h-[24px]',
    md: 'w-[120px] h-[40px]',
    lg: 'w-[180px] h-[60px]',
  };

  return (
    <div className="flex flex-col items-center bg-gradient-to-r from-gray-50 to-gray-100 p-3 rounded-lg border border-gray-200">
      <div className="flex items-center gap-3 mb-2">
        <div className={`relative ${sizeClasses[size]}`}>
          <Image
            src="/images/fastlane-logo.svg"
            alt="Fastlane Logo"
            fill
            style={{ objectFit: 'contain' }}
            priority
          />
        </div>
        {showText && (
          <div className="text-sm font-medium text-gray-700">Paymaster Sponsored by Fastlane</div>
        )}
      </div>

      {showText && (
        <div className="text-center">
          <p className="text-xs text-gray-500">Gas-free transactions powered by Fastlane</p>
          <p className="text-xs text-blue-500 mt-1">
            <a
              href="https://www.fastlane.xyz/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              Learn more about Fastlane
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
