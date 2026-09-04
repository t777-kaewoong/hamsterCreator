// 기본 컴포넌트를 한 곳에서 모아 내보냅니다.
// 다른 파일에서는 import { Button, Input, Modal } from '../components' 처럼
// 파일 하나씩 찾아다니지 않고 한 번에 가져다 쓸 수 있습니다.

export { default as Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { default as Input } from './Input'
export type { InputProps } from './Input'

export { default as Segmented } from './Segmented'
export type { SegmentedProps, SegmentedOption } from './Segmented'

export { default as TabPills } from './TabPills'
export type { TabPillsProps, TabPillOption } from './TabPills'

export { default as Tooltip } from './Tooltip'
export type { TooltipProps } from './Tooltip'

export { default as StatusChip } from './StatusChip'
export type { StatusChipProps, StatusChipStatus } from './StatusChip'

export { ToastProvider, useToast } from './Toast'
export type { ToastOptions, ToastTone, ToastAction } from './Toast'

export { default as Modal } from './Modal'
export type { ModalProps } from './Modal'
