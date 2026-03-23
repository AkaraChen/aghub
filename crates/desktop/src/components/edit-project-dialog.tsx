import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button, Fieldset, Label, Modal, TextField, Input } from "@heroui/react"
import { useUpdateProject, useAddProject } from "../hooks/use-projects"
import type { Project } from "../lib/store"
import { FolderIcon } from "@heroicons/react/24/outline"
import { invoke } from "@tauri-apps/api/core"

interface EditProjectDialogProps {
  project: Project
  isOpen: boolean
  onClose: () => void
}

export function EditProjectDialog({ project, isOpen, onClose }: EditProjectDialogProps) {
  const { t } = useTranslation()
  const updateProject = useUpdateProject()
  const [name, setName] = useState(project.name)

  useEffect(() => {
    setName(project.name)
  }, [project.name])

  const handleSave = () => {
    if (name.trim()) {
      updateProject.mutate(
        { id: project.id, updates: { name: name.trim() } },
        { onSuccess: onClose }
      )
    }
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
      <Modal.Container>
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("editProject")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <Fieldset>
              <TextField className="w-full">
                <Label>{t("projectName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("projectName")}
                />
              </TextField>
              <TextField className="w-full">
                <Label>{t("projectPath")}</Label>
                <Input value={project.path} readOnly />
              </TextField>
            </Fieldset>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary">
              {t("cancel")}
            </Button>
            <Button onPress={handleSave} isDisabled={!name.trim()}>
              {t("save")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

interface CreateProjectDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function CreateProjectDialog({ isOpen, onClose }: CreateProjectDialogProps) {
  const { t } = useTranslation()
  const addProject = useAddProject()
  const [name, setName] = useState("")
  const [path, setPath] = useState("")

  useEffect(() => {
    if (isOpen) {
      setName("")
      setPath("")
    }
  }, [isOpen])

  const handleFolderSelect = async () => {
    try {
      const selectedPath = await invoke<string | null>("pick_folder")
      if (selectedPath) {
        setPath(selectedPath)
        // Extract folder name from path
        const folderName = selectedPath.split(/[\\/]/).filter(Boolean).pop() || ""
        if (folderName && !name) {
          setName(folderName)
        }
      }
    } catch (error) {
      console.error("Failed to pick folder:", error)
    }
  }

  const handleSave = () => {
    if (name.trim() && path.trim()) {
      addProject.mutate(
        { name: name.trim(), path: path.trim() },
        {
          onSuccess: onClose,
          onError: (error) => {
            console.error("Failed to create project:", error)
            alert(`Failed to create project: ${error}`)
          }
        }
      )
    }
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
      <Modal.Container>
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("addProject")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <Fieldset>
              {/* Folder Picker Dropzone */}
              <div className="flex flex-col gap-2">
                <Label>{t("projectPath")}</Label>
                <button
                  type="button"
                  onClick={handleFolderSelect}
                  className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-default-200 rounded-lg cursor-pointer hover:bg-default-50 transition-colors"
                >
                  <FolderIcon className="w-10 h-10 text-muted mb-2" />
                  <span className="text-sm font-medium text-foreground">{t("selectProjectFolder")}</span>
                  <span className="text-xs text-muted">{t("clickToBrowse")}</span>
                </button>
                {path && (
                  <Input value={path} readOnly className="mt-2" />
                )}
              </div>

              {/* Name Input */}
              <TextField className="w-full">
                <Label>{t("projectName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("projectName")}
                />
              </TextField>
            </Fieldset>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary">
              {t("cancel")}
            </Button>
            <Button onPress={handleSave} isDisabled={!name.trim() || !path.trim()}>
              {t("create")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}