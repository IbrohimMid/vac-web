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
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'approval.approve_all';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'approval.inspect';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'approval.reject';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.cancel';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.diff';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.fetch_evidence_preview';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.fetch_report';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.index.rebuild';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.index.status';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.list_runs';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.replay';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.run';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.sweep.cancel';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'assessment.sweep.run';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'config.policy.get';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'config.reload';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'config.validate';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'connector.capabilities';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'connector.connect';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'connector.disconnect';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'connector.health';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'connector.list';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'context.attach_files';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'context.mention_search';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'continuous.write_config';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'extensions.list';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'extensions.update_trust';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'gate.evaluate';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'gate.override';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'gate.revoke_override';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'gate.signoff';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.approve';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.cancel';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.create';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.dispatch_local';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.dispatch_web_cli';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.export_blueprint';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.fetch';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.reject';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'handoff.status';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'message.cancel_stream';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'message.retry';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'message.submit';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'migration.create_draft';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'migration.dispatch';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'migration.dry_run';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'migration.verify_reversibility';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'overlay.dismiss';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'overlay.dismiss_all';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'overlay.open';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'palette.invoke_action';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'plan.approve';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'plan.edit';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'plan.open';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'plan.reject';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'registry.add';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'registry.reload';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'registry.sync';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'release.deploy';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'release.generate_notes';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'release.list_targets';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'release.publish';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'review.open_file';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'review.revert_all';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'review.revert_file';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'review.toggle_hunk';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'runtime.cancel_job';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'runtime.inspect_job';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'runtime.list_jobs';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.authenticate';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.close';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.config_option.set';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.create';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.history.forget';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.history.list';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.list';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.mode.set';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.rename';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.resume';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'session.snapshot';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'shell.input';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'shell.kill';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'shell.resize';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'shell.start';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'system.capabilities';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'system.ping';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'system.version';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'workbench.invoke';
      payload: unknown;
    }
  | {
      id: string;
      session_id: string;
      v: number;
      type: 'workbench.select_tab';
      payload: unknown;
    }
;
