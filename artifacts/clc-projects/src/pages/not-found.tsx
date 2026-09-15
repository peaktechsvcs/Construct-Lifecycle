import { Card, CardContent } from '@workspace/construct-lifecycle-design-system/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { routeTitles, useRouteTitle } from '@/lib/route-titles';

export default function NotFound() {
  useRouteTitle(routeTitles.notFound);
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">
              404 Page Not Found
            </h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            The requested workspace page could not be found.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
