import { Link } from 'wouter';
import { Button } from '@workspace/construct-lifecycle-design-system/components/ui/button';

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
          <Button asChild size="lg"><Link href="/sign-in">Sign In</Link></Button>
          <Button asChild size="lg" variant="outline"><Link href="/sign-up">Create an Account</Link></Button>
        </div>
        <Button asChild variant="link" className="mt-5"><Link href="/pricing">View plans and pricing</Link></Button>
      </div>
    </div>
  );
}
