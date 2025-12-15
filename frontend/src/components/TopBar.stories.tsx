import type { Meta, StoryObj } from '@storybook/react'
import TopBar from './TopBar'

const meta: Meta<typeof TopBar> = {
  title: 'Clipboard/TopBar',
  component: TopBar,
}

export default meta
type Story = StoryObj<typeof TopBar>

export const LoggedOut: Story = {
  args: {
    token: null,
    userAvatar: null,
    onLogin: () => {},
    onLogout: () => {},
    onRegister: () => {},
    onUserModal: () => {},
    onSettingsToggle: () => {},
  },
}

export const LoggedIn: Story = {
  args: {
    token: 'token',
    userAvatar: null,
    onLogin: () => {},
    onLogout: () => {},
    onRegister: () => {},
    onUserModal: () => {},
    onSettingsToggle: () => {},
  },
}
