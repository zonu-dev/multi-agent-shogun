export type WSEventType =
  | 'task_update'
  | 'report_update'
  | 'dashboard_update'
  | 'command_update'
  | 'game_state_update'
  | 'initial_state'
  | 'ws_error';

export interface WSMessage<T> {
  type: WSEventType;
  payload: T;
}
