// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.
// Source: packages/protocol/v1/command.schema.json

/**
 * Discriminated union over `type`. Narrow with `x.type === '...'`.
 */
export type Command =
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'approval.approve';
      payload: CommandApprovalApprovePayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'approval.approve_all';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'approval.inspect';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'approval.reject';
      payload: CommandApprovalRejectPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.cancel';
      payload: CommandAssessmentCancelPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.diff';
      payload: CommandAssessmentDiffPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.fetch_evidence_preview';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.fetch_report';
      payload: CommandAssessmentFetchReportPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.index.rebuild';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.index.status';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.list_runs';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.replay';
      payload: CommandAssessmentReplayPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.run';
      payload: CommandAssessmentRunPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.sweep.cancel';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.sweep.run';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'config.policy.get';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'config.reload';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'config.validate';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'connector.capabilities';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'connector.connect';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'connector.disconnect';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'connector.health';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'connector.list';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'context.attach_files';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'context.mention_search';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'continuous.write_config';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'extensions.list';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'extensions.update_trust';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'gate.evaluate';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'gate.override';
      payload: CommandGateOverridePayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'gate.revoke_override';
      payload: CommandGateRevokeOverridePayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'gate.signoff';
      payload: CommandGateSignoffPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.approve';
      payload: CommandHandoffApprovePayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.cancel';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.create';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.dispatch_local';
      payload: CommandHandoffDispatchLocalPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.dispatch_web_cli';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.export_blueprint';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.fetch';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.reject';
      payload: CommandHandoffRejectPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.status';
      payload: CommandHandoffStatusPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'message.cancel_stream';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'message.retry';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'message.submit';
      payload: CommandMessageSubmitPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'migration.create_draft';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'migration.dispatch';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'migration.dry_run';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'migration.verify_reversibility';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'overlay.dismiss';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'overlay.dismiss_all';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'overlay.open';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'palette.invoke_action';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'plan.approve';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'plan.edit';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'plan.open';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'plan.reject';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'registry.add';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'registry.reload';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'registry.sync';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'release.deploy';
      payload: CommandReleaseDeployPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'release.generate_notes';
      payload: CommandReleaseGenerateNotesPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'release.list_targets';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'release.publish';
      payload: CommandReleasePublishPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'review.open_file';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'review.revert_all';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'review.revert_file';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'review.toggle_hunk';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'runtime.cancel_job';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'runtime.inspect_job';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'runtime.list_jobs';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.authenticate';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.close';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.config_option.set';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.create';
      payload: CommandSessionCreatePayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.history.forget';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.history.list';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.list';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.mode.set';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.rename';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.resume';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.snapshot';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'shell.input';
      payload: CommandShellInputPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'shell.kill';
      payload: CommandShellKillPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'shell.resize';
      payload: CommandShellResizePayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'shell.start';
      payload: CommandShellStartPayload;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'system.capabilities';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'system.ping';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'system.version';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'workbench.invoke';
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'workbench.select_tab';
      payload: Record<string, unknown>;
    }
;

export interface CommandMessageSubmitPayload {
  text: string;
  mentions?: string[];
  attachments?: Record<string, unknown>[];
}

export interface CommandApprovalApprovePayload {
  approval_id: string;
  option_id?: string;
}

export interface CommandApprovalRejectPayload {
  approval_id: string;
  option_id?: string;
  reason?: string;
}

export interface CommandSessionCreatePayload {
  project_root: string;
  profile_id: string;
  handoff_id?: string;
  title?: string;
  agent_id?: string;
  workflow_id?: string;
}

export interface CommandGateSignoffPayload {
  gate_id: string;
}

export interface CommandGateOverridePayload {
  gate_id: string;
  reason?: string;
  expires_at?: string;
}

export interface CommandGateRevokeOverridePayload {
  gate_id: string;
}

export interface CommandHandoffApprovePayload {
  handoff_id: string;
}

export interface CommandHandoffDispatchLocalPayload {
  handoff_id: string;
}

export interface CommandHandoffRejectPayload {
  handoff_id: string;
  reason?: string;
}

export interface CommandHandoffStatusPayload {
  handoff_id: string;
}

export interface CommandAssessmentRunPayload {
  families?: string[];
  depth?: string;
}

export interface CommandAssessmentFetchReportPayload {
  run_id: string;
}

export interface CommandAssessmentReplayPayload {
  run_id: string;
}

export interface CommandAssessmentCancelPayload {
  run_id: string;
}

export interface CommandAssessmentDiffPayload {
  base_run_id: string;
  next_run_id: string;
}

export interface CommandReleaseDeployPayload {
  target_id: string;
}

export interface CommandReleasePublishPayload {
  target_id: string;
}

export interface CommandReleaseGenerateNotesPayload {
  target_id: string;
}

export interface CommandShellStartPayload {
  command: string;
  cwd?: string;
}

export interface CommandShellInputPayload {
  terminal_id: string;
  input: string;
}

export interface CommandShellKillPayload {
  terminal_id: string;
}

export interface CommandShellResizePayload {
  terminal_id: string;
}
