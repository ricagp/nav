#ifndef IUPDATABLE_H
#define IUPDATABLE_H

class IUpdatable {
public:
    // Destructor virtual: muy recomendable en clases base abstractas 
    // para asegurar que la memoria se libere correctamente si se destruyen objetos.
    virtual ~IUpdatable() = default;

    // Métodos virtuales puros (= 0) que obligan a las clases hijas 
    // a implementar su propia inicialización y actualización.
    virtual void begin() = 0;
    virtual void update() = 0;
};

#endif