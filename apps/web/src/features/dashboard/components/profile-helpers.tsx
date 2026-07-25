export function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs font-semibold text-red-600">{message}</p> : null
}
