import { render, screen } from '@testing-library/react'
import Card from './Card'

const noop = () => {}

test('renderiza texto y resalta coincidencias', () => {
  render(
    <Card
      item={{ value: 'Hola mundo', favorite: false }}
      selected={false}
      onCopy={noop}
      onToggleFavorite={noop}
      highlightMatch={(t) => [t]}
      search={'Hola'}
    />
  )
  expect(screen.getByText(/Hola mundo/i)).toBeInTheDocument()
})
