import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast font-body group-[.toaster]:rounded-2xl group-[.toaster]:border-chat-panel-border group-[.toaster]:bg-chat-surface group-[.toaster]:text-chat-ink group-[.toaster]:shadow-[0_18px_40px_-24px_oklch(0.2_0.05_288/0.55)]",
          description: "group-[.toast]:text-chat-ink-soft",
          actionButton: "group-[.toast]:bg-chat-ink group-[.toast]:text-chat-on-ink",
          cancelButton: "group-[.toast]:bg-white/60 group-[.toast]:text-chat-ink-soft",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
