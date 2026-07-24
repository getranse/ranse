// Shape-matched shimmer placeholder — perceived-speed beats a spinner. The
// shimmer keyframe lives in the Tailwind layer (tailwind.css utilities cover
// animate-pulse); we use a token-tinted bar and respect reduced motion.
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-hover motion-reduce:animate-none ${className}`}
      aria-hidden
    />
  );
}

const ROW_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

/** A list of row-shaped skeletons for the conversation list first paint. */
export function RowSkeletons({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col">
      {ROW_KEYS.slice(0, count).map((key) => (
        <div key={key} className="flex items-center gap-3 border-border/60 border-b px-4 py-3">
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-3/4" />
          </div>
          <Skeleton className="h-2.5 w-10" />
        </div>
      ))}
    </div>
  );
}
