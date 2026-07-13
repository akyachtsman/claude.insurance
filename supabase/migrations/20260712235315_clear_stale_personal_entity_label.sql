-- Clear the stale display-only label on the account-holder (personal) entity.
-- The "You · personal" string was legacy display text baked into `label`; the
-- UBO sub-label is now computed in one place (entity-display.js), so the stored
-- value is dead and was diverging from the computed one.
-- revert: no automatic inverse — the cleared strings were free-text display
-- labels with no canonical source to restore; re-seed by hand if ever needed.
update public.entities set label = null where kind = 'personal' and label is not null;
