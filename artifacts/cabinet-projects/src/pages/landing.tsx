import { Link } from 'wouter';

export function LandingPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background p-4 text-center">
      <div className="animate-rise max-w-md">
        <img 
          src={`${basePath}/logo-full-slogan.svg`} 
          alt="Construct Lifecycle — From Bid to Closeout"
          className="mx-auto mb-8 h-20 object-contain drop-shadow-sm" 
        />
        <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Construct Lifecycle
        </h1>
        <p className="mb-10 text-base text-muted-foreground">
          From Bid to Closeout.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link 
            href="/sign-in" 
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
          >
            Sign In
          </Link>
          <Link 
            href="/sign-up" 
            className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground hover:bg-secondary transition-colors"
          >
            Create an Account
          </Link>
        </div>
      </div>
    </div>
  );
}
