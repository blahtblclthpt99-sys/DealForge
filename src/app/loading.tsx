export default function Loading() {
  return (
    <div className="dn-container py-10 sm:py-12 lg:py-14" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading DealForge</span>
      <div className="skeleton h-7 w-32 rounded-full" />
      <div className="mt-4 skeleton h-12 max-w-xl rounded-2xl sm:h-14" />
      <div className="mt-3 skeleton h-5 max-w-2xl rounded-xl" />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="dn-card overflow-hidden" aria-hidden="true">
            <div className="skeleton aspect-square w-full" />
            <div className="space-y-3 p-4">
              <div className="skeleton h-3 w-20 rounded-full" />
              <div className="skeleton h-5 w-full rounded-lg" />
              <div className="skeleton h-5 w-3/4 rounded-lg" />
              <div className="skeleton h-7 w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
