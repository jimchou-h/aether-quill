export type PersonaUpdateInput = {
  name?: string;
  profile?: string;
  state?: string;
};

export function normalizePersonaUpdateInput(payload: PersonaUpdateInput) {
  return {
    name: payload.name?.trim(),
    profile: payload.profile?.trim(),
    state: payload.state?.trim(),
  };
}

export function resolveActivePersonaIdAfterDelete(
  activePersonaId: string | null,
  deletedPersonaId: string
) {
  return activePersonaId === deletedPersonaId ? null : activePersonaId;
}
