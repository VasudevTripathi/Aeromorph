import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import ProjectsHome from './components/ProjectsHome';
import ImportPhotographs from './components/ImportPhotographs';
import ReconstructionStudio from './components/ReconstructionStudio';
import CreateProjectModal from './components/CreateProjectModal';
import {
  getStoredProjects,
  getActiveProjectId,
  setActiveProjectId as persistActiveProjectId,
  deleteProject as deleteProjectRecord,
  setProjectSourceImages,
  setProjectModelFile,
  setProjectNativeDirectory,
  setProjectOutputDirectory,
  setProjectNativePly,
  getSessionAssets,
} from './services/projectService';
import './App.css';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('home'); // 'home' | 'import' | 'studio'
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Re-render trigger when in-memory session assets are modified
  const [sessionTick, setSessionTick] = useState(0);

  // Initialize projects and active project on mount
  useEffect(() => {
    const loadedProjects = getStoredProjects();
    setProjects(loadedProjects);

    const savedActiveId = getActiveProjectId();
    if (savedActiveId && loadedProjects.some((p) => p.id === savedActiveId)) {
      setActiveProjectId(savedActiveId);
    } else if (loadedProjects.length > 0) {
      setActiveProjectId(loadedProjects[0].id);
      persistActiveProjectId(loadedProjects[0].id);
    } else {
      setActiveProjectId(null);
      persistActiveProjectId(null);
    }
  }, []);

  // Compute active project
  const currentProject = projects.find((p) => p.id === activeProjectId) || null;

  // Retrieve current in-memory session assets and native references for active project
  const {
    modelFile: sessionModelFile,
    imageFiles: sessionImages,
    nativeDirectory,
    nativePly,
  } = getSessionAssets(activeProjectId);

  // Navigation & Project Handlers
  const handleOpenCreateModal = () => {
    setIsCreateModalOpen(true);
  };

  const handleProjectCreated = (newProject, openDirectlyInStudio = false) => {
    const updated = getStoredProjects();
    setProjects(updated);
    setActiveProjectId(newProject.id);
    persistActiveProjectId(newProject.id);
    setSessionTick((t) => t + 1);

    if (openDirectlyInStudio || newProject.modelFileReference) {
      setCurrentScreen('studio');
    } else {
      setCurrentScreen('import');
    }
  };

  const handleOpenProject = (projectId, destinationScreen = 'studio') => {
    if (projectId) {
      setActiveProjectId(projectId);
      persistActiveProjectId(projectId);
    }
    setSessionTick((t) => t + 1);
    setCurrentScreen(destinationScreen);
  };

  const handleDeleteProject = (projectId) => {
    const updated = deleteProjectRecord(projectId);
    setProjects(updated);
    const nextActive = getActiveProjectId();
    setActiveProjectId(nextActive);
    setSessionTick((t) => t + 1);
  };

  const handleUpdateProjectImages = (projectId, dirName, files) => {
    const updatedProject = setProjectSourceImages(projectId, dirName, files);
    if (updatedProject) {
      setProjects(getStoredProjects());
      setSessionTick((t) => t + 1);
    }
  };

  const handleUpdateProjectNativeDirectory = (projectId, dirInfo) => {
    const updatedProject = setProjectNativeDirectory(projectId, dirInfo);
    if (updatedProject) {
      setProjects(getStoredProjects());
      setSessionTick((t) => t + 1);
    }
  };

  const handleUpdateProjectOutputDirectory = (projectId, dirInfo) => {
    const updatedProject = setProjectOutputDirectory(projectId, dirInfo);
    if (updatedProject) {
      setProjects(getStoredProjects());
      setSessionTick((t) => t + 1);
    }
  };

  const handleAttachModelFile = (file) => {
    if (!activeProjectId) return;
    const updatedProject = setProjectModelFile(activeProjectId, file);
    if (updatedProject) {
      setProjects(getStoredProjects());
      setSessionTick((t) => t + 1);
    }
  };

  const handleAttachNativePly = (plyInfo) => {
    if (!activeProjectId) return;
    const updatedProject = setProjectNativePly(activeProjectId, plyInfo);
    if (updatedProject) {
      setProjects(getStoredProjects());
      setSessionTick((t) => t + 1);
    }
  };

  const handleProceedToStudio = () => {
    setCurrentScreen('studio');
  };

  const handleNavigateHome = () => {
    setCurrentScreen('home');
  };

  const handleNavigateImport = () => {
    setCurrentScreen('import');
  };

  const handleSelectProject = (projectId) => {
    setActiveProjectId(projectId);
    persistActiveProjectId(projectId);
    setSessionTick((t) => t + 1);
  };

  return (
    <div className="app-container">
      {/* Top Header with Brand, Active Project & Navigation */}
      <Header
        currentScreen={currentScreen}
        setCurrentScreen={setCurrentScreen}
        currentProject={currentProject}
      />

      {/* Main Dynamic Viewport */}
      <main className="app-content" id="main-content">
        {currentScreen === 'home' && (
          <ProjectsHome
            projects={projects}
            activeProjectId={activeProjectId}
            onNewReconstruction={handleOpenCreateModal}
            onOpenProject={handleOpenProject}
            onDeleteProject={handleDeleteProject}
          />
        )}

        {currentScreen === 'import' && (
          <ImportPhotographs
            currentProject={currentProject}
            sessionImages={sessionImages}
            nativeDirectory={nativeDirectory}
            projects={projects}
            onUpdateProjectImages={handleUpdateProjectImages}
            onUpdateProjectNativeDirectory={handleUpdateProjectNativeDirectory}
            onUpdateProjectOutputDirectory={handleUpdateProjectOutputDirectory}
            onProceedToStudio={handleProceedToStudio}
            onNavigateHome={handleNavigateHome}
            onSelectProject={handleSelectProject}
          />
        )}

        {currentScreen === 'studio' && (
          <ReconstructionStudio
            currentProject={currentProject}
            sessionModelFile={sessionModelFile}
            onAttachModelFile={handleAttachModelFile}
            onAttachNativePly={handleAttachNativePly}
            onUpdateProjectOutputDirectory={handleUpdateProjectOutputDirectory}
            onNavigateHome={handleNavigateHome}
            onNavigateImport={handleNavigateImport}
          />
        )}
      </main>

      {/* Project Creation Dialog */}
      <CreateProjectModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onProjectCreated={handleProjectCreated}
        existingProjects={projects}
      />
    </div>
  );
}
