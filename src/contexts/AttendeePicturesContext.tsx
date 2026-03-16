import React, { createContext, useContext } from 'react';
import { useAttendeePictures } from '@/hooks/useAttendeePictures';

type AttendeePicturesContextType = ReturnType<typeof useAttendeePictures>;

const AttendeePicturesContext = createContext<AttendeePicturesContextType | null>(null);

export const AttendeePicturesProvider: React.FC<{
  organizationId: string | null;
  children: React.ReactNode;
}> = ({ organizationId, children }) => {
  const value = useAttendeePictures(organizationId);
  return (
    <AttendeePicturesContext.Provider value={value}>
      {children}
    </AttendeePicturesContext.Provider>
  );
};

export function useAttendeePicturesContext() {
  const ctx = useContext(AttendeePicturesContext);
  if (!ctx) {
    throw new Error('useAttendeePicturesContext must be used within AttendeePicturesProvider');
  }
  return ctx;
}
