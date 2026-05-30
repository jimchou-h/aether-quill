import { Modal } from 'ant-design-vue';

export interface AppConfirmOptions {
  title: string;
  content: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}

/** 统一确认框，替代 window.confirm */
export function confirmAction(options: AppConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: options.title,
      content: options.content,
      okText: options.okText ?? '确定',
      cancelText: options.cancelText ?? '取消',
      okType: options.danger ? 'danger' : 'primary',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
