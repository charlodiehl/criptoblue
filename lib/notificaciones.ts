// ─────────────────────────────────────────────────────────────────────────────
// Grupos de notificaciones push (por ahora, solo para administradores).
//
// Cada grupo es un tipo de evento que el admin puede activar/desactivar por
// separado desde la página de Notificaciones. La preferencia se guarda por usuario
// (email) en la tabla notification_prefs; la ausencia de valor = ACTIVADO por
// defecto (al prender las notificaciones, llegan todas hasta que se apaguen).
//
// Esta lista es la fuente de verdad compartida entre el frontend (página de
// preferencias) y el backend (envío por evento). Para agregar un evento nuevo:
// sumar una entrada acá y llamar a notifyAdmins(<key>, payload) donde ocurra.
// ─────────────────────────────────────────────────────────────────────────────

export type EventoKey =
  | 'transferencia_solicitada'
  | 'reembolso_solicitado'
  | 'pago_adjudicado'

export interface GrupoNotificacion {
  key: EventoKey
  label: string
  descripcion: string
}

export const GRUPOS_NOTIFICACION: GrupoNotificacion[] = [
  {
    key: 'transferencia_solicitada',
    label: 'Transferencia solicitada',
    descripcion: 'Cuando una tienda (o un admin) arma una solicitud de transferencia para pagar.',
  },
  {
    key: 'reembolso_solicitado',
    label: 'Reembolso solicitado',
    descripcion: 'Cuando ingresa una solicitud de reembolso.',
  },
  {
    key: 'pago_adjudicado',
    label: 'Pago adjudicado por una tienda',
    descripcion: 'Cuando una tienda se adjudica un pago y le pone un número de orden, para ir a corroborar.',
  },
]

// Preferencias de un usuario: { [key]: boolean }. Falta de clave = true (activado).
export type NotificationPrefs = Partial<Record<EventoKey, boolean>>

// ¿El usuario quiere recibir este grupo? Default: sí (mientras no lo haya apagado).
export function quiereEvento(prefs: NotificationPrefs | null | undefined, key: EventoKey): boolean {
  return prefs?.[key] !== false
}
