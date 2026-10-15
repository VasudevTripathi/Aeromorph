import React, { useState } from 'react';
import Header from './components/Header';
import ProjectsHome from './components/ProjectsHome';
import ImportPhotographs from './components/ImportPhotographs';
import ReconstructionStudio from './components/ReconstructionStudio';
import './App.css';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('home'); // 'home' | 'import' | 'studio'

  const handleNewReconstruction = () => {
    setCurrentScreen('import');
  };

  const handleOpenProject = (projectId) => {
    setCurrentScreen('studio');
  };

  const handleProceedToStudio = () => {
    setCurrentScreen('studio');
  };

  return (
    <div className="app-container">
      {/* Top Header with Brand & Navigation */}
      <Header
        currentScreen={currentScreen}
        setCurrentScreen={setCurrentScreen}
      />

      {/* Main Dynamic Viewport */}
      <main className="app-content" id="main-content">
        {currentScreen === 'home' && (
          <ProjectsHome
            onNewReconstruction={handleNewReconstruction}
            onOpenProject={handleOpenProject}
          />
        )}

        {currentScreen === 'import' && (
          <ImportPhotographs
            onProceedToStudio={handleProceedToStudio}
          />
        )}

        {currentScreen === 'studio' && (
          <ReconstructionStudio />
        )}
      </main>
    </div>
  );
}
