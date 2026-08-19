import { useNavigate, useParams } from 'react-router-dom'
import MasterForm from './MasterForm'

export default function MasterRecordCreatePage() {
  const { slug } = useParams()
  const navigate = useNavigate()

  return (
    <MasterForm
      slug={slug}
      variant="wizard"
      onSave={(id) => navigate(id ? `/masters/${slug}/records/${id}` : `/masters/${slug}`)}
      onCancel={() => navigate(`/masters/${slug}`)}
    />
  )
}
