// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/action_spec.schema.json

export interface ActionSpec {
  available_when?: string;
  description?: string;
  footer_visible?: boolean;
  group: string;
  id: string;
  keybinding?: string;
  label: string;
  palette_visible?: boolean;
  prepare_ui?: 'file_picker' | 'form_modal';
  required_capabilities?: string[];
  slash_alias?: string;
}
