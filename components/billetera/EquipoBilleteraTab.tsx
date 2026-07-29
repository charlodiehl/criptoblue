'use client'

import { PERMISOS_BILLETERA } from '@/lib/permisos'
import EquipoGestion from '@/components/EquipoGestion'
import type { Toast } from './BilleteraPortal'

// Sección "Equipo" de una billetera: integrantes con acceso + sus permisos.
// La pantalla es la misma que la de tiendas (components/EquipoGestion.tsx); acá solo
// se dice CUÁLES son los permisos y contra qué endpoints trabaja.

export default function EquipoBilleteraTab({ qs, notify }: { qs: string; notify: (m: string, t?: Toast['type']) => void }) {
  return (
    <EquipoGestion
      entidad="la billetera"
      permisos={PERMISOS_BILLETERA}
      apiBase="/api/billetera/equipo"
      qs={qs}
      notify={notify}
      notaAccesoBase="entrar a la billetera y ver el extracto por día. No hace falta activarlo."
    />
  )
}
