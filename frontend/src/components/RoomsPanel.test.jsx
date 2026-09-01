import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RoomsPanel from './RoomsPanel'

const SAMPLE_ROOMS = [
  { id: 1, name: 'Lab 1', room_type: 'lab', capacity: 30 },
  { id: 2, name: 'Room 101', room_type: null, capacity: null },
]

describe('RoomsPanel', () => {
  it('renders every room passed in, with type/capacity when present', () => {
    render(<RoomsPanel schoolId={1} rooms={SAMPLE_ROOMS} onCreate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Lab 1 · lab · capacity 30')).toBeInTheDocument()
    expect(screen.getByText('Room 101')).toBeInTheDocument()
  })

  it('calls onCreate with the entered values when the add form is submitted', () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<RoomsPanel schoolId={5} rooms={[]} onCreate={onCreate} onDelete={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Room name (e.g. Lab 1)'), { target: { value: 'Chem Lab' } })
    fireEvent.change(screen.getByPlaceholderText('Capacity'), { target: { value: '25' } })
    fireEvent.change(screen.getByPlaceholderText('Type (e.g. lab, regular)'), { target: { value: 'lab' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onCreate).toHaveBeenCalledWith({
      school_id: 5,
      name: 'Chem Lab',
      capacity: 25,
      room_type: 'lab',
    })
  })

  it('does not call onCreate if the name field is blank', () => {
    const onCreate = vi.fn()
    render(<RoomsPanel schoolId={5} rooms={[]} onCreate={onCreate} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onCreate).not.toHaveBeenCalled()
  })

  describe('when readOnly', () => {
    it('hides the add form and every Remove button', () => {
      render(<RoomsPanel schoolId={1} rooms={SAMPLE_ROOMS} onCreate={vi.fn()} onDelete={vi.fn()} readOnly />)
      expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
      expect(screen.getByText('Lab 1 · lab · capacity 30')).toBeInTheDocument()
    })
  })
})
