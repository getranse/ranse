import { Toaster as SonnerToaster, toast } from 'sonner';

// Single toast surface for the app. Async/background failures and confirmations
// go here (form-field validation stays inline next to the input). Mounted once
// in App; `toast.*` is callable from anywhere, including non-component code.
export { toast };

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      theme="system"
      richColors
      closeButton
      gap={8}
      toastOptions={{ duration: 5000 }}
    />
  );
}
