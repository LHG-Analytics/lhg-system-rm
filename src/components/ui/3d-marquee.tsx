'use client'

import { cn } from '@/lib/utils'
import Image from 'next/image'

interface ThreeDMarqueeProps {
  images: string[]
  className?: string
}

export function ThreeDMarquee({ images, className }: ThreeDMarqueeProps) {
  const chunkSize = Math.ceil(images.length / 4)
  const rows: string[][] = Array.from({ length: 4 }, (_, i) =>
    images.slice(i * chunkSize, (i + 1) * chunkSize)
  )

  return (
    <div
      className={cn('h-full w-full overflow-hidden', className)}
      style={{ perspective: '1200px' }}
    >
      <div
        className="flex h-full flex-col justify-center gap-3 py-4"
        style={{
          transform: 'rotateX(12deg) rotateY(-6deg) rotateZ(3deg) scale(1.15)',
          transformOrigin: 'center center',
        }}
      >
        {rows.map((row, i) => (
          <div
            key={i}
            className={cn(
              'flex shrink-0 gap-3',
              i % 2 === 0 ? 'animate-marquee' : 'animate-marquee-reverse'
            )}
          >
            {[...row, ...row, ...row, ...row].map((src, idx) => (
              <div
                key={idx}
                className="relative h-20 w-36 flex-shrink-0 overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/8"
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  className="object-contain p-3"
                  sizes="144px"
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
