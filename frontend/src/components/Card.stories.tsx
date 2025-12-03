import type { Meta, StoryObj } from '@storybook/react'
import Card from './Card'

const meta: Meta<typeof Card> = {
  title: 'Clipboard/Card',
  component: Card,
}

export default meta
type Story = StoryObj<typeof Card>

export const Text: Story = {
  args: {
    item: { value: 'Hola mundo', favorite: false },
    selected: false,
    darkMode: false,
    search: 'Hola',
    highlightMatch: (t: string) => [t],
    onCopy: () => {},
    onToggleFavorite: () => {},
  },
}

export const Code: Story = {
  args: {
    item: { value: 'const x = 1;', favorite: true },
    selected: true,
    darkMode: true,
    search: '',
    highlightMatch: (t: string) => [t],
    onCopy: () => {},
    onToggleFavorite: () => {},
  },
}
